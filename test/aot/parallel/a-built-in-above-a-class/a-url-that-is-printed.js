function below(kind) { let top = Object; if (kind) top = kind.top; class Below extends top {} return Below; }
const D = below({ top: URL }); const made = new D("http://made.up/path?x=1"); console.log(made.pathname, made instanceof URL); console.log(made);
