function define(params) { const Parent = params?.Parent ?? Object; class Definition extends Parent {} return Definition; }
console.log(typeof new (define())(), new (define({ Parent: Error }))() instanceof Error);
