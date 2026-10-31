use super::*;
use crate::atom::Interner;
use crate::fold::{Constant, Define};
use crate::hir_from_data::DataValue;
use crate::session::Session;

const PLAIN: LinkForm = LinkForm::DOT;
const OPTIONAL: LinkForm = LinkForm {
    is_in_optional_chain: true,
    ..LinkForm::DOT
};
const INDEX: LinkForm = LinkForm {
    is_index: true,
    ..LinkForm::DOT
};

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
        links: &[(&str, LinkForm)],
    ) -> Option<PathState> {
        let root = inputs.root(root)?;
        links.iter().try_fold(root, |state, &(name, form)| {
            inputs.child(state, self.atom(name), form)
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
    let follow = |links: &[(&str, LinkForm)]| workspace.follow(&inputs, a, links);
    let value_at = |links: &[(&str, LinkForm)]| inputs.value_of(follow(links).unwrap());
    assert_eq!(value_at(&[]), None);
    assert_eq!(value_at(&[("b", PLAIN)]), Some(number(1.0)));
    assert_eq!(value_at(&[("b", PLAIN), ("c", PLAIN)]), Some(number(2.0)));
    assert_eq!(follow(&[("b", PLAIN), ("c", PLAIN), ("d", PLAIN)]), None);
    assert_eq!(follow(&[("b", PLAIN), ("d", PLAIN)]), None);
    assert_eq!(follow(&[("c", PLAIN)]), None);
    assert_eq!(follow(&[("b", PLAIN)]).unwrap().drop, DropReach::None);
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
fn index_link_is_a_step_of_a_path() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.sample_inputs();
    let a = workspace.global("a");
    let follow = |links: &[(&str, LinkForm)]| workspace.follow(&inputs, a, links);
    let value_at = |links: &[(&str, LinkForm)]| inputs.value_of(follow(links).unwrap());
    assert_eq!(value_at(&[("b", INDEX)]), Some(number(1.0)));
    assert_eq!(value_at(&[("b", PLAIN), ("c", INDEX)]), Some(number(2.0)));
    assert_eq!(value_at(&[("b", INDEX), ("c", PLAIN)]), Some(number(2.0)));
    assert_eq!(value_at(&[("b", INDEX), ("c", INDEX)]), Some(number(2.0)));
    let x = workspace.follow(&inputs, DefineRoot::ImportMeta, &[("x", INDEX)]);
    assert_eq!(inputs.value_of(x.unwrap()), Some(number(3.0)));
}

#[test]
#[cfg_attr(miri, ignore)]
fn optional_link_is_a_step_of_a_path() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.sample_inputs();
    let a = workspace.global("a");
    let value_at =
        |links: &[(&str, LinkForm)]| inputs.value_of(workspace.follow(&inputs, a, links).unwrap());
    assert_eq!(value_at(&[("b", OPTIONAL)]), Some(number(1.0)));
    assert_eq!(
        value_at(&[("b", OPTIONAL), ("c", PLAIN)]),
        Some(number(2.0))
    );
    assert_eq!(
        value_at(&[("b", PLAIN), ("c", OPTIONAL)]),
        Some(number(2.0))
    );
    let x = workspace.follow(&inputs, DefineRoot::ImportMeta, &[("x", OPTIONAL)]);
    assert_eq!(inputs.value_of(x.unwrap()), Some(number(3.0)));
}

#[test]
#[cfg_attr(miri, ignore)]
fn plain_path_define_has_its_value_on_a_plain_path_alone() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let a = workspace.global("a");
    let defines = [
        workspace.define(a, &["b"], 1.0),
        workspace.define(a, &["b", "c"], 2.0),
        workspace.define(a, &["b", "d"], 4.0),
    ];
    let options = FoldOptions {
        defines: slice_in(&defines, workspace.arena),
        plain_path_defines: slice_in(
            &[workspace.path(a, &["b"]), workspace.path(a, &["b", "c"])],
            workspace.arena,
        ),
        ..FoldOptions::default()
    };
    let inputs = FoldInputs::new(options, workspace.arena);
    let value_at =
        |links: &[(&str, LinkForm)]| inputs.value_of(workspace.follow(&inputs, a, links).unwrap());
    assert_eq!(value_at(&[("b", PLAIN)]), Some(number(1.0)));
    assert_eq!(value_at(&[("b", INDEX)]), None);
    assert_eq!(value_at(&[("b", OPTIONAL)]), None);
    assert_eq!(value_at(&[("b", PLAIN), ("c", PLAIN)]), Some(number(2.0)));
    assert_eq!(value_at(&[("b", INDEX), ("c", PLAIN)]), Some(number(2.0)));
    assert_eq!(value_at(&[("b", PLAIN), ("c", INDEX)]), None);
    assert_eq!(value_at(&[("b", OPTIONAL), ("c", PLAIN)]), None);
    assert_eq!(value_at(&[("b", PLAIN), ("c", OPTIONAL)]), None);
    assert_eq!(
        value_at(&[("b", OPTIONAL), ("d", INDEX)]),
        Some(number(4.0))
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn index_link_behind_dropped_path_is_dropped_only_as_callee() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.sample_inputs();
    let console = workspace.global("console");
    let reach = |links: &[(&str, LinkForm)]| {
        let state = workspace.follow(&inputs, console, links);
        state.map_or(DropReach::None, |state| state.drop)
    };
    assert_eq!(reach(&[("log", PLAIN)]), DropReach::Whole);
    assert_eq!(reach(&[("log", INDEX)]), DropReach::AtIndex);
    assert_eq!(
        reach(&[("log", PLAIN), ("call", INDEX)]),
        DropReach::AtIndex
    );
    for receiver_call in ["call", "apply"] {
        let links = [("log", INDEX), (receiver_call, PLAIN)];
        assert_eq!(reach(&links), DropReach::BehindIndex, "{receiver_call}");
        let below = [("log", INDEX), (receiver_call, PLAIN), ("call", PLAIN)];
        assert_eq!(reach(&below), DropReach::None, "{receiver_call}");
    }
    assert_eq!(reach(&[("log", INDEX), ("bind", PLAIN)]), DropReach::None);
    assert_eq!(reach(&[("log", INDEX), ("call", INDEX)]), DropReach::None);
    assert_eq!(
        reach(&[("a", PLAIN), ("log", INDEX), ("b", PLAIN)]),
        DropReach::None
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn computed_link_is_a_step_of_no_path() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.sample_inputs();
    let console = workspace.follow(&inputs, workspace.global("console"), &[]);
    let computed = inputs.computed_child(console.unwrap()).unwrap();
    assert_eq!((computed.node, computed.drop), (None, DropReach::AtIndex));
    let call = inputs.child(computed, workspace.atom("call"), PLAIN);
    assert_eq!(call.unwrap().drop, DropReach::BehindIndex);
    assert_eq!(inputs.child(computed, workspace.atom("bind"), PLAIN), None);
    assert_eq!(inputs.computed_child(computed), None);

    let b = workspace.follow(&inputs, workspace.global("a"), &[("b", PLAIN)]);
    assert_eq!(inputs.computed_child(b.unwrap()), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn dropped_path_covers_members() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.sample_inputs();
    let console = workspace.global("console");
    let paths: [&[&str]; 3] = [&[], &["log"], &["a", "b"]];
    for form in [PLAIN, OPTIONAL] {
        for members in paths {
            let links: Vec<(&str, LinkForm)> =
                members.iter().map(|&member| (member, form)).collect();
            let state = workspace.follow(&inputs, console, &links).unwrap();
            assert_eq!(state.drop, DropReach::Whole, "{links:?}");
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
    let follow = |links: &[(&str, LinkForm)]| workspace.follow(&inputs, console, links);
    assert_eq!(follow(&[]).unwrap().drop, DropReach::None);
    assert_eq!(follow(&[("log", PLAIN)]), None);
    assert_eq!(follow(&[("debug", PLAIN)]).unwrap().drop, DropReach::Whole);
    let bind = follow(&[("debug", PLAIN), ("bind", PLAIN)]);
    assert_eq!(bind.unwrap().drop, DropReach::Whole);
}

#[test]
#[cfg_attr(miri, ignore)]
fn index_link_within_dropped_path_is_a_step_of_it() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let tools = workspace.global("tools");
    let inputs = workspace.inputs(&[], &[workspace.path(tools, &["log", "trace"])]);
    let reach = |links: &[(&str, LinkForm)]| {
        let state = workspace.follow(&inputs, tools, links);
        state.map_or(DropReach::None, |state| state.drop)
    };
    assert_eq!(reach(&[("log", PLAIN)]), DropReach::None);
    assert_eq!(reach(&[("log", PLAIN), ("trace", PLAIN)]), DropReach::Whole);
    assert_eq!(reach(&[("log", INDEX), ("trace", PLAIN)]), DropReach::Whole);
    assert_eq!(
        reach(&[("log", OPTIONAL), ("trace", OPTIONAL)]),
        DropReach::Whole
    );
    assert_eq!(
        reach(&[("log", INDEX), ("trace", PLAIN), ("deep", PLAIN)]),
        DropReach::Whole
    );
    assert_eq!(
        reach(&[("log", PLAIN), ("trace", INDEX)]),
        DropReach::AtIndex
    );
    assert_eq!(
        reach(&[("log", PLAIN), ("trace", INDEX), ("deep", PLAIN)]),
        DropReach::None
    );
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
    assert_eq!(level.unwrap().drop, DropReach::Whole);
}

#[test]
#[cfg_attr(miri, ignore)]
fn bound_root_has_only_what_is_there_in_every_run() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let process = workspace.global("process");
    let platform = Define {
        path: workspace.path(process, &["platform"]),
        value: DefineValue::RuntimeConstant(Constant::Number(7.0)),
    };
    let defines = [workspace.define(process, &["level"], 1.0), platform];
    let inputs = workspace.inputs(&defines, &[workspace.path(process, &["exit"])]);
    let bound = PathState {
        is_bound_root: true,
        ..inputs.root(process).unwrap()
    };
    let member = |name: &str| inputs.child(bound, workspace.atom(name), PLAIN);
    assert_eq!(inputs.value_of(member("level").unwrap()), None);
    assert_eq!(
        inputs.value_of(member("platform").unwrap()),
        Some(platform.value)
    );
    assert_eq!(member("exit").unwrap().drop, DropReach::None);
    let free = workspace.follow(&inputs, process, &[("exit", PLAIN)]);
    assert_eq!(free.unwrap().drop, DropReach::Whole);
}

#[test]
#[cfg_attr(miri, ignore)]
fn only_the_global_nan_is_left_to_a_dynamic_root() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let nan = DefineValue::Constant(Constant::Number(f64::NAN));
    let defines = ["NaN", "LIMIT"].map(|name| Define {
        path: workspace.path(workspace.global(name), &[]),
        value: nan,
    });
    let inputs = workspace.inputs(&defines, &[]);
    let value_under_dynamic_root = |name: &str| {
        let root = inputs.root(workspace.global(name)).unwrap();
        inputs.value_of(PathState {
            has_dynamic_root: true,
            ..root
        })
    };
    assert_eq!(value_under_dynamic_root("NaN"), None);
    let is_nan =
        |value| matches!(value, Some(DefineValue::Constant(Constant::Number(n))) if n.is_nan());
    assert!(is_nan(value_under_dynamic_root("LIMIT")));
    assert!(is_nan(
        inputs.value_of(inputs.root(workspace.global("NaN")).unwrap())
    ));
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
        assert_eq!(root.drop, DropReach::None, "{name}");
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
        is_bound_root: false,
        has_optional_link: false,
        ends_with_index: false,
        drop: DropReach::Whole,
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
