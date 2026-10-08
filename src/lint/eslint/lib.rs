//! The rules of ESLint. Each is a port of the rule of the same name in
//! https://github.com/eslint/eslint (Copyright OpenJS Foundation and other contributors, MIT
//! License): the same options, the same messages, at the same places.

bun_lint::rules! {
    eqeqeq::Eqeqeq,
    max_depth::MaxDepth,
    no_cond_assign::NoCondAssign,
    no_debugger::NoDebugger,
}
