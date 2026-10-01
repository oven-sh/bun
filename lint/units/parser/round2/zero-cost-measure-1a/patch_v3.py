#!/usr/bin/env python3
"""V3 = V1 + the reader of the base (e3566be889) for a type that nothing is kept of: what a parse without lint pays
when `Discard` reads types as before. Measurement only: the base reader rejects what P1 made valid.
usage: patch_v3.py <root> <base parse_skip_typescript.rs> <base type_sink.rs>"""
import sys, re
root = sys.argv[1] + '/src/js_parser/'
base = open(sys.argv[2]).read().split('\n')
sink = open(sys.argv[3]).read().split('\n')
def sub(path, old, new, count=1):
    s = open(root + path).read()
    assert s.count(old) == count, (path, old[:70], s.count(old))
    open(root + path, 'w').write(s.replace(old, new))
def fn(name):
    idx = [i for i, l in enumerate(base) if re.match(r'\s{4}(pub(\(crate\))? )?fn ' + re.escape(name) + r'\b', l)]
    assert len(idx) == 1, (name, idx)
    a = idx[0]
    while base[a - 1].startswith('    #[') or base[a - 1].startswith('    ///'): a -= 1
    b = idx[0]
    while base[b] != '    }': b += 1
    return '\n'.join(base[a:b + 1])
names = ['skip_typescript_return_type', 'skip_type_script_type', 'skip_typescript_fn_args', 'skip_type_script_paren_or_fn_type',
         'skip_type_script_type_with_opts', 'skip_type_script_object_type', 'skip_type_script_type_arguments',
         'skip_type_script_constraint_of_infer_type_with_backtracking', 'try_skip_type_script_constraint_of_infer_type_with_backtracking',
         'skip_type_script_arrow_args_with_backtracking', 'try_skip_type_script_arrow_args_with_backtracking']
body = '\n\n'.join(fn(n) for n in names)
ren = [('try_skip_type_script_constraint_of_infer_type_with_backtracking', 'flat_try_constraint_of_infer_type'),
       ('skip_type_script_constraint_of_infer_type_with_backtracking', 'flat_constraint_of_infer_type'),
       ('try_skip_type_script_arrow_args_with_backtracking', 'flat_try_arrow_args'),
       ('skip_type_script_arrow_args_with_backtracking', 'flat_arrow_args'),
       ('skip_typescript_return_type', 'flat_return_type'), ('skip_type_script_type_with_opts', 'flat_type_with_opts'),
       ('skip_typescript_fn_args', 'flat_fn_args'), ('skip_type_script_paren_or_fn_type', 'flat_paren_or_fn_type'),
       ('skip_type_script_object_type', 'flat_object_type'), ('skip_type_script_type_arguments', 'flat_type_arguments')]
for a, b in ren: body = body.replace(a, b)
body = re.sub(r'\bskip_type_script_type\(', 'flat_skip_type(', body)
body = body.replace('TypeSink', 'flat_sink::TypeSink').replace('::<Discard>', '::<flat_sink::Discard>').replace('TypeLiteral::', 'flat_sink::TypeLiteral::').replace('TypeKeyword::', 'flat_sink::TypeKeyword::').replace('Operand::', 'flat_sink::Operand::')
# the sink of the base: the trait, its enums and Discard
a = next(i for i, l in enumerate(sink) if l.startswith('pub(crate) trait TypeSink'))
while sink[a - 1].startswith('///') or sink[a - 1].startswith('#['): a -= 1
b = next(i for i, l in enumerate(sink) if l.startswith('/// Computes the `design:type`'))
sink_text = '\n'.join(sink[a:b])
flat = '\n/// Measurement only: the sink and the reader of the base.\nmod flat_sink {\n    use bun_ast::Ref;\n    use bun_ast::op::Level;\n' + '\n'.join('    ' + l if l else l for l in sink_text.split('\n')) + '\n}\n\nimpl<\'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<\'a, TYPESCRIPT, SCAN_ONLY> {\n' + body + '\n}\n'
F = 'parse/parse_skip_typescript.rs'
s = open(root + F).read()
i = s.index('\n#[cfg(test)]\nmod tests {')
open(root + F, 'w').write(s[:i] + flat + s[i:])

# hooks: where nothing is kept of a type, the reader of the base reads it
sub(F, """        out: &mut S::Out,
    ) -> Result<(), Error> {
        self.mark_type_script_only();

        if !self.stack_check.is_safe_to_recurse() {
            return Err(Error::StackOverflow);
        }

        if self.is_start_of_function_type_or_constructor_type() {""", """        out: &mut S::Out,
    ) -> Result<(), Error> {
        if core::mem::size_of::<S::Out>() == 0 {
            return self.flat_type_with_opts::<flat_sink::Discard>(Level::Lowest, opts, &mut ());
        }
        self.mark_type_script_only();

        if !self.stack_check.is_safe_to_recurse() {
            return Err(Error::StackOverflow);
        }

        if self.is_start_of_function_type_or_constructor_type() {""")
sub(F, """    pub(crate) fn skip_type_script_object_type(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();
""", """    pub(crate) fn skip_type_script_object_type(&mut self) -> Result<(), Error> {
        if true {
            return self.flat_object_type();
        }
        self.mark_type_script_only();
""")
sub(F, """    fn parse_object_type_members(&mut self) -> Result<(), Error> {
        self.lexer.expect(T::TOpenBrace)?;""", """    fn parse_object_type_members(&mut self) -> Result<(), Error> {
        if true {
            return self.flat_object_type();
        }
        self.lexer.expect(T::TOpenBrace)?;""")
sub(F, """    ) -> Result<(bool, KK<N, Option<b::Closed>>), Error> {
        self.mark_type_script_only();""", """    ) -> Result<(bool, KK<N, Option<b::Closed>>), Error> {
        if core::mem::size_of::<N::Out>() == 0 {
            let has = self
                .flat_type_arguments::<IS_INSIDE_JSX_ELEMENT, IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION>()?;
            return Ok((has, ConstDefault::DEFAULT));
        }
        self.mark_type_script_only();""")
sub(F, """        out: &mut S::Out,
    ) -> Result<(), Error> {
        self.mark_type_script_only();

        if self.try_skip_type_script_arrow_args_with_backtracking() {
            self.skip_typescript_return_type()?;
            S::function_type(out);
            return Ok(());
        }
""", """        out: &mut S::Out,
    ) -> Result<(), Error> {
        if core::mem::size_of::<S::Out>() == 0 {
            return self.flat_paren_or_fn_type::<flat_sink::Discard>(&mut ());
        }
        self.mark_type_script_only();

        if self.try_skip_type_script_arrow_args_with_backtracking() {
            self.skip_typescript_return_type()?;
            S::function_type(out);
            return Ok(());
        }
""")
sub(F, """    pub(crate) fn skip_typescript_return_type(&mut self) -> Result<(), Error> {
""", """    pub(crate) fn skip_typescript_return_type(&mut self) -> Result<(), Error> {
        if true {
            return self.flat_return_type();
        }
""")
sub(F, """    pub(crate) fn skip_typescript_fn_args(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();
""", """    pub(crate) fn skip_typescript_fn_args(&mut self) -> Result<(), Error> {
        if true {
            return self.flat_fn_args();
        }
        self.mark_type_script_only();
""")
print('v3 patched')
