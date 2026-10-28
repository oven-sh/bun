use super::table::{self, BuiltinClass, BuiltinId, BuiltinKind, ClassData, Platforms, TypeName};
use bun_sema::check::aot::{
    BuiltinClassIndex, BuiltinTypeClass, BuiltinTypePath, BuiltinTypeSymbols, BuiltinValueIndex,
    BuiltinValuePath, Denotation,
};
use smallvec::SmallVec;

#[cfg(test)]
mod tests;

type StaticNames = &'static [&'static str];

fn split_module(path: StaticNames) -> (Option<&'static str>, StaticNames) {
    match path.split_first() {
        Some((&first, rest)) if table::module_by_specifier(first.as_bytes()).is_some() => {
            (Some(first), rest)
        }
        Some(_) | None => (None, path),
    }
}

fn declared_denotation(data: &ClassData, name: &TypeName) -> Denotation {
    if data.has_instance_test && !name.is_view {
        Denotation::Exact
    } else {
        Denotation::View
    }
}

pub fn builtin_type_paths() -> Vec<BuiltinTypePath<'static>> {
    let mut paths = Vec::new();
    for class in BuiltinClass::ALL {
        let data = table::class_data(class);
        for (type_name, name) in (0u32..).zip(data.type_names) {
            let (module, names) = split_module(name.path);
            paths.push(BuiltinTypePath {
                class: BuiltinClassIndex(class.to_wire()),
                type_name,
                module,
                names,
                denotation: declared_denotation(data, name),
            });
        }
    }
    paths
}

pub fn builtin_class_of(index: BuiltinClassIndex) -> Option<BuiltinClass> {
    BuiltinClass::from_wire(index.0)
}

pub fn builtin_value_of(index: BuiltinValueIndex) -> Option<BuiltinId> {
    BuiltinId::from_wire(index.0)
}

pub fn type_name_of(class: BuiltinTypeClass) -> Option<&'static TypeName> {
    let data = table::class_data(builtin_class_of(class.class)?);
    data.type_names.get(class.type_name as usize)
}

fn declared_denotation_of(class: BuiltinTypeClass) -> Option<Denotation> {
    let data = table::class_data(builtin_class_of(class.class)?);
    let name = data.type_names.get(class.type_name as usize)?;
    Some(declared_denotation(data, name))
}

pub fn count_types_degraded_to_views(types: &BuiltinTypeSymbols) -> u64 {
    let classes = types.classes().map(|(_, class)| class);
    let degraded = classes.filter(|&class| {
        class.denotation == Denotation::View
            && declared_denotation_of(class) == Some(Denotation::Exact)
    });
    degraded.count() as u64
}

struct ValueSpan {
    id: BuiltinId,
    module: Option<&'static str>,
    first_name: u32,
    name_count: u32,
}

pub struct BuiltinValuePaths {
    names: Vec<&'static str>,
    values: Vec<ValueSpan>,
}

fn can_have_call_signatures(kind: BuiltinKind) -> bool {
    !matches!(
        kind,
        BuiltinKind::Namespace
            | BuiltinKind::Prototype
            | BuiltinKind::Constant
            | BuiltinKind::NativeBinding
    )
}

// The module, and the names from the last to the first.
type PublishedPath = (Option<&'static str>, SmallVec<[&'static str; 4]>);

fn find_published_path(id: BuiltinId) -> Option<PublishedPath> {
    let mut reversed_names = SmallVec::new();
    let mut member = id;
    loop {
        let entry = table::entry(member);
        let Some(holder) = entry.holder else {
            let module = table::module_data(entry.module?).specifier;
            return Some((Some(module), reversed_names));
        };
        if table::is_symbol_name(entry.name) || table::entry(holder).kind == BuiltinKind::Prototype
        {
            return None;
        }
        reversed_names.push(std::str::from_utf8(table::text_of_name(entry.name)).ok()?);
        if holder == BuiltinId::GlobalThis {
            return Some((None, reversed_names));
        }
        member = holder;
    }
}

impl BuiltinValuePaths {
    pub fn collect(platform: Platforms) -> BuiltinValuePaths {
        let mut paths = BuiltinValuePaths {
            names: Vec::new(),
            values: Vec::new(),
        };
        for id in BuiltinId::ALL {
            if !can_have_call_signatures(table::entry(id).kind) || !table::exists_on(id, platform) {
                continue;
            }
            let Some((module, reversed_names)) = find_published_path(id) else {
                continue;
            };
            if reversed_names.is_empty() {
                continue;
            }
            paths.values.push(ValueSpan {
                id,
                module,
                first_name: paths.names.len() as u32,
                name_count: reversed_names.len() as u32,
            });
            paths.names.extend(reversed_names.iter().rev());
        }
        paths.add_members_under_second_names(platform);
        paths.values.sort_by_key(|value| value.id.to_wire());
        paths
    }

    // An object with a second name, as `self` is `globalThis`, has its members under that name too, and a declaration file can give them signatures of their own there.
    fn add_members_under_second_names(&mut self, platform: Platforms) {
        for second_name in BuiltinId::ALL {
            let Some(object) = table::entry(second_name).same_object_as else {
                continue;
            };
            if !table::exists_on(second_name, platform) {
                continue;
            }
            let Some((module, reversed_names)) = find_published_path(second_name) else {
                continue;
            };
            for &member in table::members(object) {
                let entry = table::entry(member);
                if !can_have_call_signatures(entry.kind)
                    || !table::exists_on(member, platform)
                    || table::is_symbol_name(entry.name)
                {
                    continue;
                }
                let Ok(name) = std::str::from_utf8(table::text_of_name(entry.name)) else {
                    continue;
                };
                self.values.push(ValueSpan {
                    id: member,
                    module,
                    first_name: self.names.len() as u32,
                    name_count: reversed_names.len() as u32 + 1,
                });
                self.names.extend(reversed_names.iter().rev());
                self.names.push(name);
            }
        }
    }

    pub fn paths(&self) -> Vec<BuiltinValuePath<'_>> {
        let values = self.values.iter();
        values
            .map(|value| BuiltinValuePath {
                value: BuiltinValueIndex(value.id.to_wire()),
                module: value.module,
                names: &self.names[value.first_name as usize..][..value.name_count as usize],
            })
            .collect()
    }
}
