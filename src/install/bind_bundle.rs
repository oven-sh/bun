//! The turn of a bundler: a package whose tarball ships other packages in its own `node_modules`.
//! `bundle::read_bundle` read what it ships. Here every shipped folder becomes a package of the
//! lockfile, and the rows of the bundler and of those packages are bound to them, so that the
//! lockfile records the folders as they are on disk. No row is resolved from the registry here.

use bun_alloc::AllocError;
use bun_collections::{HashMap, index_sort};
use bun_semver::{ExternalString, String};

use crate::bundle::{BundleContents, DeclaredDependency, ShippedFolder};
use crate::dependency::{self, Behavior};
use crate::lockfile_real::package::meta::ShippedIdentity;
use crate::lockfile_real::package::{Package, PackageColumns as _};
use crate::lockfile_real::{CatalogMap, DependencySlice, Lockfile, PackageIDSlice, StringBuilder};
use crate::package_installer::alias_is_safe_install_target;
use crate::{
    Dependency, DependencyID, DependencyVersionTag, PackageID, PackageManager, invalid_package_id,
};

struct Row {
    dependency: Dependency,
    package_id: PackageID,
    /// `Scratch::refreshing`, for a row that is copied.
    refreshing: bool,
}

/// A folder of `BundleContents` that becomes a package.
struct Shipped<'a> {
    folder: &'a ShippedFolder,
    /// Index in the list of shipped packages of the one whose `node_modules` holds the folder.
    /// `None` if the bundler's holds it.
    parent: Option<u32>,
    identity: ShippedIdentity<'a>,
    /// A row of the parent is bound to it.
    placed: bool,
    rows: Vec<Row>,
}

/// A parent and a folder name, to the index of the shipped package in that folder.
type Places<'a> = HashMap<(Option<u32>, &'a [u8]), u32>;

/// The rows that a shipped package.json declares, each with its group. The names come from an
/// archive, and a row is the name of a folder in `node_modules`.
fn declared_rows(folder: &ShippedFolder) -> impl Iterator<Item = (&DeclaredDependency, Behavior)> {
    let optional = folder.optional_dependencies.iter();
    let prod = folder.dependencies.iter();
    (optional.map(|row| (row, Behavior::OPTIONAL)))
        .chain(prod.map(|row| (row, Behavior::PROD)))
        .filter(|(row, _)| alias_is_safe_install_target(&row.name))
}

/// Returns `None` for a range that does not parse and for a `catalog:` range: the row is left out.
/// bun.lock's reader never binds a row without a version, so a folder with that name gets the row
/// that nothing declares instead.
fn declared_row(
    string_builder: &mut StringBuilder<'_>,
    declared: &DeclaredDependency,
    group: Behavior,
) -> Option<Dependency> {
    let name = string_builder.append::<ExternalString>(&declared.name);
    let range = string_builder.append::<String>(&declared.range);
    let sliced = range.sliced(string_builder.string_bytes.as_slice());
    let mut row = Dependency {
        name: name.value,
        name_hash: name.hash,
        behavior: group,
        version: dependency::parse(
            name.value,
            Some(name.hash),
            sliced.slice,
            &sliced,
            None::<&mut bun_ast::Log>,
            None::<&mut PackageManager>,
        )?,
    };
    CatalogMap::strip_reference(&mut row);
    (row.version.tag() != DependencyVersionTag::Uninitialized).then_some(row)
}

/// The shipped package that Node finds for `name` from the folder of `from`, above that folder's
/// own `node_modules`: it looks in each `node_modules` on the way up, and the last one is the
/// bundler's. What is outside the bundler is not looked at.
fn find_above(
    places: &Places<'_>,
    shipped: &[Shipped<'_>],
    from: usize,
    name: &[u8],
) -> Option<u32> {
    let mut level = shipped[from].parent;
    loop {
        if let Some(&found) = places.get(&(level, name)) {
            return Some(found);
        }
        // A parent comes before its folders, so this ends.
        level = shipped[level? as usize].parent;
    }
}

impl Lockfile {
    /// Binds the package `bundler` to what its tarball ships. `contents` is `None` if that could
    /// not be read, which binds like a tarball that ships nothing. Returns the rows of `bundler`,
    /// which are new rows at the end of the buffers: call this before any of them is queued.
    ///
    /// - A row of `bundler` with the name of a folder in its `node_modules` becomes a bundled row
    ///   and is bound to the package in that folder, whatever range the row has. A row without a
    ///   version (`CatalogMap::strip_reference`) is dropped instead, as `declared_row` does.
    /// - A bundled row without a folder stays unresolved.
    /// - Every other folder there gets a row that nothing declares, which is bound to the package
    ///   in it: `ShippedIdentity::append_synthetic_row`.
    /// - Each shipped folder, at any depth, is appended as a package that `Meta::is_shipped`
    ///   marks. Its rows are the `dependencies` and `optionalDependencies` of its package.json,
    ///   and the folders in its own `node_modules`, which are its bundled rows. A row without
    ///   such a folder is bound to what `find_above` finds, or stays unresolved.
    pub fn bind_bundle(
        &mut self,
        bundler: PackageID,
        contents: Option<&BundleContents>,
    ) -> Result<DependencySlice, AllocError> {
        let folders: &[ShippedFolder] = match contents {
            Some(contents) => &contents.folders,
            None => &[],
        };
        // `append_package` gives the shipped packages these ids, in the order of `shipped`.
        let first_id = self.packages.len() as PackageID;

        let mut shipped: Vec<Shipped<'_>> = Vec::with_capacity(folders.len());
        let mut places = Places::default();
        // By index in `folders`. `None`: the folder is not a package, nor is any folder below it.
        let mut shipped_index: Vec<Option<u32>> = Vec::with_capacity(folders.len());
        for folder in folders {
            let index = 'index: {
                let parent = match folder.parent {
                    None => None,
                    Some(parent) => match shipped_index.get(parent as usize) {
                        Some(&Some(parent)) => Some(parent),
                        _ => break 'index None,
                    },
                };
                let Some(identity) = ShippedIdentity::new(
                    folder.folder_name(),
                    Some(&*folder.name),
                    &folder.version,
                ) else {
                    break 'index None;
                };
                let place = places.get_or_put((parent, folder.folder_name()))?;
                if place.found_existing {
                    break 'index None;
                }
                let index = shipped.len() as u32;
                *place.value_ptr = index;
                shipped.push(Shipped {
                    folder,
                    parent,
                    identity,
                    placed: false,
                    rows: Vec::new(),
                });
                Some(index)
            };
            shipped_index.push(index);
        }

        let old_rows = self.packages.items_dependencies()[bundler as usize];
        let unplaced = (old_rows.begin()..old_rows.end()).any(|id| self.is_in_unplaced_subtree(id));
        let mut bundler_rows: Vec<Row> = Vec::with_capacity(old_rows.len as usize);
        for id in old_rows.begin()..old_rows.end() {
            let mut dependency = self.buffers.dependencies[id as usize].clone();
            let in_folder = {
                let name = dependency.name.slice(self.buffers.string_bytes.as_slice());
                places.get(&(None, name)).copied()
            };
            // The old rows are dropped, so what is recorded for their ids moves with them.
            let was_refreshing = self.take_refreshing(id);
            let row = if let Some(index) = in_folder {
                if dependency.version.tag() == DependencyVersionTag::Uninitialized {
                    continue;
                }
                dependency.behavior.insert(Behavior::BUNDLED);
                shipped[index as usize].placed = true;
                Row {
                    dependency,
                    package_id: first_id + index,
                    refreshing: false,
                }
            } else if dependency.behavior.is_bundled() {
                Row {
                    dependency,
                    package_id: invalid_package_id,
                    refreshing: false,
                }
            } else {
                Row {
                    dependency,
                    package_id: self.buffers.resolutions[id as usize],
                    refreshing: was_refreshing,
                }
            };
            bundler_rows.push(row);
        }

        // The strings of the shipped packages and of their rows, as in `Package::from_npm`: count,
        // allocate, append, clamp. A row that is counted is not always appended.
        let mut string_builder = crate::string_builder!(self);
        for package in &shipped {
            package.identity.count_package(&mut string_builder);
            package.identity.count_synthetic_row(&mut string_builder);
            for (declared, _) in declared_rows(package.folder) {
                string_builder.count(&declared.name);
                string_builder.count(&declared.range);
            }
        }
        string_builder.allocate()?;

        let mut packages: Vec<Package> = Vec::with_capacity(shipped.len());
        for index in 0..shipped.len() {
            let folder = shipped[index].folder;
            packages.push(shipped[index].identity.append_package(&mut string_builder));

            let mut rows: Vec<Row> =
                Vec::with_capacity(folder.dependencies.len() + folder.optional_dependencies.len());
            for (declared, group) in declared_rows(folder) {
                let Some(mut dependency) = declared_row(&mut string_builder, declared, group)
                else {
                    continue;
                };
                let name: &[u8] = &declared.name;
                let bound = if let Some(&inside) = places.get(&(Some(index as u32), name)) {
                    dependency.behavior.insert(Behavior::BUNDLED);
                    shipped[inside as usize].placed = true;
                    Some(inside)
                } else {
                    find_above(&places, &shipped, index, name)
                };
                rows.push(Row {
                    dependency,
                    package_id: bound.map_or(invalid_package_id, |index| first_id + index),
                    refreshing: false,
                });
            }
            shipped[index].rows = rows;
        }

        for index in 0..shipped.len() {
            let package = &shipped[index];
            if package.placed {
                continue;
            }
            let parent = package.parent;
            let row = Row {
                dependency: package.identity.append_synthetic_row(&mut string_builder),
                package_id: first_id + index as PackageID,
                refreshing: false,
            };
            match parent {
                Some(parent) => shipped[parent as usize].rows.push(row),
                None => bundler_rows.push(row),
            }
        }
        string_builder.clamp();

        // `clean_with_logger` drops the old rows of the bundler.
        let rows_of_bundler = self.append_rows(bundler_rows);
        self.packages.items_dependencies_mut()[bundler as usize] = rows_of_bundler;
        self.packages.items_resolutions_mut()[bundler as usize] =
            PackageIDSlice::new(rows_of_bundler.off, rows_of_bundler.len);
        if unplaced {
            self.mark_unplaced_subtree(rows_of_bundler);
        }

        for (shipped, mut package) in shipped.into_iter().zip(packages) {
            let rows = self.append_rows(shipped.rows);
            package.dependencies = rows;
            package.resolutions = PackageIDSlice::new(rows.off, rows.len);
            self.append_package(&package)?;
        }
        // Every row was bound to an id that `append_package` has given out by now.
        debug_assert!(
            (self.buffers.resolutions[rows_of_bundler.begin() as usize..].iter())
                .all(|&id| id == invalid_package_id || (id as usize) < self.packages.len())
        );

        Ok(rows_of_bundler)
    }

    /// Writes the rows of one package at the end of the buffers, in the order in which bun.lock's
    /// reader has the rows of a package.
    fn append_rows(&mut self, mut rows: Vec<Row>) -> DependencySlice {
        let buf = self.buffers.string_bytes.as_slice();
        index_sort::sort_vec_by(&mut rows, |a, b| {
            Dependency::cmp(buf, &a.dependency, &b.dependency)
        });

        debug_assert_eq!(
            self.buffers.dependencies.len(),
            self.buffers.resolutions.len()
        );
        let off = self.buffers.dependencies.len() as u32;
        let len = rows.len() as u32;
        self.buffers.dependencies.reserve(rows.len());
        self.buffers.resolutions.reserve(rows.len());
        for row in rows {
            let id = self.buffers.dependencies.len() as DependencyID;
            self.buffers.dependencies.push(row.dependency);
            self.buffers.resolutions.push(row.package_id);
            if row.refreshing {
                self.mark_refreshing(id);
            }
        }
        DependencySlice::new(off, len)
    }
}
