function below(kind) { let top = Object; if (kind) top = kind.top; class Below extends top {} return Below; }
console.log(typeof new (below())(), new (below({ top: Array }))() instanceof Array);
