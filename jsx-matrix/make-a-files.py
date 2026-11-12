import subprocess, sys
A="137c00c053e"
def show(path):
    return subprocess.check_output(["git","-C","/workspace/bun","show",f"{A}:{path}"]).decode()
def rep(s, old, new):
    assert s.count(old)==1, (s.count(old), old[:80])
    return s.replace(old,new)
# jsx.rs: MemberList::stated and Stated::states_nothing
s=show("src/options_types/jsx.rs")
s=rep(s,"""    /// The names between the dots of `text`, or `default` when it holds none, as `"."`.
    pub fn from_text_or(text: &[u8], default: &'static [&'static [u8]]) -> MemberList {
        let default = MemberList::Static(default);
        Pragma::member_list_to_components_if_different(&default, text).unwrap_or(default)
    }
""","""    /// The names between the dots of `text` as a source states them. `None` when it holds none, as `""` and `"."`.
    pub fn stated(text: &[u8], default: &'static [&'static [u8]]) -> Option<MemberList> {
        Pragma::member_list_to_components_if_different(&MemberList::Static(default), text)
    }
""")
final=open("/workspace/bun/src/options_types/jsx.rs").read()
start=final.index("    /// Whether no option is stated.\n    pub fn states_nothing(&self) -> bool {")
end=final.index("    /// Lays `top` over `self`: option by option, what `top` states wins.")
fn_text=final[start:end]
anchor="    /// Lays `top` over `self`: option by option, what `top` states wins."
assert s.count(anchor)==1
s=s.replace(anchor, fn_text+anchor)
open("/tmp/a-jsx.rs","w").write(s)
# tsconfig_json.rs: the test helper goes
t=show("src/resolver/tsconfig_json.rs")
t=rep(t,"""    fn states_nothing(jsx: &Stated) -> bool {
        let Stated {
            runtime,
            development,
            factory,
            fragment,
            import_source,
            side_effects,
        } = jsx;
        runtime.is_none()
            && development.is_none()
            && factory.is_none()
            && fragment.is_none()
            && import_source.is_none()
            && side_effects.is_none()
    }

""","")
t=rep(t,"""            assert!(states_nothing(&config.jsx), "{unread}");
""","""            assert!(config.jsx.states_nothing(), "{unread}");
""")
t=rep(t,"""        assert!(states_nothing(&config.jsx));
""","""        assert!(config.jsx.states_nothing());
""")
t=rep(t,"""    use options::jsx::{MemberList, Runtime, Stated};
""","""    use options::jsx::{MemberList, Runtime};
""")
open("/tmp/a-tsconfig_json.rs","w").write(t)
print("ok")
