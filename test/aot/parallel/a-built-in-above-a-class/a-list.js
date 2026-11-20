function below(kind) { let top = Object; if (kind) top = kind.top; class Below extends top {} return Below; }
const D = below({ top: Array }); const made = new D(); made.push(1, 2); console.log(made.length, Array.isArray(made), JSON.stringify(made), made instanceof D, made.map(x => x * 2) instanceof D, D.from([1]) instanceof D);
