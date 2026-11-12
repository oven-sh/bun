function define(params) { const Parent = params?.Parent ?? Object; class Definition extends Parent {} return Definition; }
const D = define({ Parent: URL }); const made = new D("http://made.up/path?x=1"); console.log(made.pathname, made instanceof URL); console.log(made);
