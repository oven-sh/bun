function define(params) { const Parent = params?.Parent ?? Object; class Definition extends Parent {} return Definition; }
const D = define({ Parent: Array }); const made = new D(); made.push(1, 2); console.log(made.length, Array.isArray(made), JSON.stringify(made), made instanceof D, made.map(x => x * 2) instanceof D, D.from([1]) instanceof D);
