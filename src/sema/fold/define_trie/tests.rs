use super::*;
use crate::atom::Interner;
use crate::fold::{Constant, Define};
use crate::hir_from_data::DataValue;
use crate::session::Session;

const PLAIN: bool = false;
const OPTIONAL: bool = true;

fn number(value: f64) -> DefineValue<'static> {
    DefineValue::Constant(Constant::Number(value))
}

struct Workspace<'s> {
    atoms: Interner<'s>,
    arena: &'s Arena,
}

impl<'s> Workspace<'s> {
    fn new(session: &'s Session) -> Workspace<'s> {
        Workspace {
            atoms: Interner::new_in(session),
            arena: session.arena(),
        }
    }

    fn atom(&self, text: &str) -> Atom {
        self.atoms.intern(text.as_bytes())
    }

    fn global(&self, name: &str) -> DefineRoot {
        DefineRoot::Global(self.atom(name))
    }

    fn path(&self, root: DefineRoot, members: &[&str]) -> DefinePath<'s> {
        let members: Vec<Atom> = members.iter().map(|member| self.atom(member)).collect();
        DefinePath {
            root,
            members: slice_in(&members, self.arena),
        }
    }

    fn define(&self, root: DefineRoot, members: &[&str], value: f64) -> Define<'s> {
        Define {
            path: self.path(root, members),
            value: number(value),
        }
    }

    fn inputs(&self, defines: &[Define<'s>], dropped_calls: &[DefinePath<'s>]) -> FoldInputs<'s> {
        let options = FoldOptions {
            defines: slice_in(defines, self.arena),
            dropped_calls: slice_in(dropped_calls, self.arena),
            ..FoldOptions::default()
        };
        FoldInputs::new(options, self.arena)
    }

    fn feature_inputs(&self, flag: Atom) -> FoldInputs<'s> {
        let options = FoldOptions {
            features: slice_in(&[flag], self.arena),
            ..FoldOptions::default()
        };
        FoldInputs::new(options, self.arena)
    }

    fn sample_inputs(&self) -> FoldInputs<'s> {
        let a = self.global("a");
        let defines = [
            self.define(a, &["b"], 1.0),
            self.define(a, &["b", "c"], 2.0),
            self.define(DefineRoot::ImportMeta, &["x"], 3.0),
        ];
        self.inputs(&defines, &[self.path(self.global("console"), &[])])
    }

    fn follow(
        &self,
        inputs: &FoldInputs<'s>,
        root: DefineRoot,
        links: &[(&str, bool)],
    ) -> Option<PathState> {
        let root = inputs.root(root)?;
        links
            .iter()
            .try_fold(root, |state, &(name, is_in_optional_chain)| {
                inputs.child(state, self.atom(name), is_in_optional_chain)
            })
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn nested_defines_have_separate_values() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.sample_inputs();
    let a = workspace.global("a");
    let follow = |links: &[(&str, bool)]| workspace.follow(&inputs, a, links);
    let value_at = |links: &[(&str, bool)]| inputs.value_of(follow(links).unwrap());
    assert_eq!(value_at(&[]), None);
    assert_eq!(value_at(&[("b", PLAIN)]), Some(number(1.0)));
    assert_eq!(value_at(&[("b", PLAIN), ("c", PLAIN)]), Some(number(2.0)));
    assert_eq!(follow(&[("b", PLAIN), ("c", PLAIN), ("d", PLAIN)]), None);
    assert_eq!(follow(&[("b", PLAIN), ("d", PLAIN)]), None);
    assert_eq!(follow(&[("c", PLAIN)]), None);
    assert!(!follow(&[("b", PLAIN)]).unwrap().is_dropped);
}

#[test]
#[cfg_attr(miri, ignore)]
fn import_meta_root_has_members() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.sample_inputs();
    let root = inputs.root(DefineRoot::ImportMeta).unwrap();
    assert_eq!(inputs.value_of(root), None);
    let x = inputs.child(root, workspace.atom("x"), PLAIN).unwrap();
    assert_eq!(inputs.value_of(x), Some(number(3.0)));
    assert_eq!(inputs.child(root, workspace.atom("b"), PLAIN), None);
    assert_eq!(inputs.root(workspace.global("x")), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn optional_link_hides_value() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.sample_inputs();
    let a = workspace.global("a");
    let paths: [&[(&str, bool)]; 4] = [
        &[("b", OPTIONAL)],
        &[("b", OPTIONAL), ("c", PLAIN)],
        &[("b", PLAIN), ("c", OPTIONAL)],
        &[("b", OPTIONAL), ("c", OPTIONAL)],
    ];
    for links in paths {
        let state = workspace.follow(&inputs, a, links).unwrap();
        assert_eq!(inputs.value_of(state), None, "{links:?}");
    }
    let x = workspace.follow(&inputs, DefineRoot::ImportMeta, &[("x", OPTIONAL)]);
    assert_eq!(inputs.value_of(x.unwrap()), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn dropped_path_covers_members() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.sample_inputs();
    let console = workspace.global("console");
    let paths: [&[&str]; 3] = [&[], &["log"], &["a", "b"]];
    for is_in_optional_chain in [PLAIN, OPTIONAL] {
        for members in paths {
            let links: Vec<(&str, bool)> = members
                .iter()
                .map(|&member| (member, is_in_optional_chain))
                .collect();
            let state = workspace.follow(&inputs, console, &links).unwrap();
            assert!(state.is_dropped, "{links:?}");
            assert_eq!(inputs.value_of(state), None, "{links:?}");
        }
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn dropped_member_path_excludes_siblings() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let console = workspace.global("console");
    let inputs = workspace.inputs(&[], &[workspace.path(console, &["debug"])]);
    let follow = |links: &[(&str, bool)]| workspace.follow(&inputs, console, links);
    assert!(!follow(&[]).unwrap().is_dropped);
    assert_eq!(follow(&[("log", PLAIN)]), None);
    assert!(follow(&[("debug", PLAIN)]).unwrap().is_dropped);
    assert!(
        follow(&[("debug", PLAIN), ("bind", PLAIN)])
            .unwrap()
            .is_dropped
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn optional_link_breaks_dropped_path() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let tools = workspace.global("tools");
    let inputs = workspace.inputs(&[], &[workspace.path(tools, &["log", "trace"])]);
    let is_dropped =
        |links: &[(&str, bool)]| workspace.follow(&inputs, tools, links).unwrap().is_dropped;
    assert!(is_dropped(&[("log", PLAIN), ("trace", PLAIN)]));
    assert!(!is_dropped(&[("log", OPTIONAL), ("trace", PLAIN)]));
    assert!(!is_dropped(&[("log", PLAIN), ("trace", OPTIONAL)]));
    assert!(!is_dropped(&[("log", OPTIONAL), ("trace", OPTIONAL)]));
    assert!(is_dropped(&[
        ("log", PLAIN),
        ("trace", PLAIN),
        ("deep", OPTIONAL)
    ]));
}

#[test]
#[cfg_attr(miri, ignore)]
fn define_below_dropped_path_has_value() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let console = workspace.global("console");
    let inputs = workspace.inputs(
        &[workspace.define(console, &["level"], 1.0)],
        &[workspace.path(console, &[])],
    );
    let level = workspace.follow(&inputs, console, &[("level", PLAIN)]);
    assert_eq!(inputs.value_of(level.unwrap()), Some(number(1.0)));
    assert!(level.unwrap().is_dropped);
}

#[test]
#[cfg_attr(miri, ignore)]
fn unknown_root_has_no_state() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.sample_inputs();
    assert_eq!(inputs.root(workspace.global("consol")), None);
    assert_eq!(inputs.root(workspace.global("b")), None);
    let console = workspace.atom("console");
    let same_filter_bit = (0..64)
        .map(|index| workspace.atom(&format!("unused{index}")))
        .find(|&name| root_filter_bit(name) == root_filter_bit(console))
        .unwrap();
    assert_eq!(inputs.root(DefineRoot::Global(same_filter_bit)), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn later_define_wins() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let a = workspace.global("a");
    let defines = [
        workspace.define(a, &["b"], 1.0),
        workspace.define(a, &["b"], 2.0),
    ];
    let inputs = workspace.inputs(&defines, &[]);
    let b = workspace.follow(&inputs, a, &[("b", PLAIN)]).unwrap();
    assert_eq!(inputs.value_of(b), Some(number(2.0)));
}

#[test]
#[cfg_attr(miri, ignore)]
fn empty_options_build_empty_inputs() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.inputs(&[], &[]);
    assert!(inputs.is_empty());
    assert_eq!(inputs.root(workspace.global("a")), None);
    assert_eq!(inputs.root(DefineRoot::ImportMeta), None);
    let console = workspace.path(workspace.global("console"), &[]);
    assert!(!workspace.inputs(&[], &[console]).is_empty());
    assert!(!workspace.sample_inputs().is_empty());
}

#[test]
#[cfg_attr(miri, ignore)]
fn features_and_switches_pass_through() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.feature_inputs(workspace.atom("ON"));
    assert!(inputs.is_empty());
    assert!(inputs.has_feature(workspace.atom("ON")));
    assert!(!inputs.has_feature(workspace.atom("OFF")));
    assert!(!inputs.preserves_unused_imports());
    let options = FoldOptions {
        preserves_unused_imports: true,
        ..FoldOptions::default()
    };
    let inputs = FoldInputs::new(options, workspace.arena);
    assert!(!inputs.has_feature(workspace.atom("ON")));
    assert!(inputs.preserves_unused_imports());
}

#[test]
#[cfg_attr(miri, ignore)]
fn string_limit_passes_through() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    assert_eq!(workspace.inputs(&[], &[]).max_string_bytes, 0);
    let options = FoldOptions {
        max_string_bytes: 1 << 16,
        ..FoldOptions::default()
    };
    let inputs = FoldInputs::new(options, workspace.arena);
    assert_eq!(inputs.max_string_bytes, 1 << 16);
    assert!(inputs.is_empty());
}

#[test]
#[cfg_attr(miri, ignore)]
fn define_values_keep_their_kind() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let target = slice_in(&[workspace.atom("a"), workspace.atom("b")], workspace.arena);
    let data: &DataValue<'_> = workspace.arena.alloc(DataValue::Array(&[]));
    let values = [
        (
            "TEXT",
            DefineValue::Constant(Constant::String(workspace.atom("t"))),
        ),
        ("ABSENT", DefineValue::Constant(Constant::Undefined)),
        ("RENAMED", DefineValue::GlobalPath(target)),
        ("LIST", DefineValue::Data(data)),
    ];
    let defines = values.map(|(name, value)| Define {
        path: workspace.path(workspace.global(name), &[]),
        value,
    });
    let inputs = workspace.inputs(&defines, &[]);
    for (name, value) in values {
        let root = inputs.root(workspace.global(name)).unwrap();
        assert_eq!(inputs.value_of(root), Some(value), "{name}");
        assert!(!root.is_dropped, "{name}");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn state_below_dropped_path_has_no_node() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.sample_inputs();
    let console = workspace.global("console");
    let root = workspace.follow(&inputs, console, &[]).unwrap();
    assert!(root.node.is_some());
    let log = workspace
        .follow(&inputs, console, &[("log", PLAIN)])
        .unwrap();
    let expected = PathState {
        node: None,
        has_optional_link: false,
        is_dropped: true,
        has_dynamic_root: false,
    };
    assert_eq!(log, expected);
    let optional = workspace.follow(&inputs, console, &[("log", OPTIONAL), ("call", PLAIN)]);
    let expected = PathState {
        has_optional_link: true,
        ..expected
    };
    assert_eq!(optional, Some(expected));
}
