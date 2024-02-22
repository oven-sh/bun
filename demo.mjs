Bun.plugin({
  name: 'demo',
  setup(b) {
  b.onResolve({ filter: /.*/, namespace: 'file' }, async (args) => {
      console.log('onResolve', args)
      return { path: args.path, namespace: 'file' }
    });
  },
})
console.log(import.meta.resolveSync('#foo', 'file:/Users/dave'))
console.log(await import.meta.resolveSync('#foo', 'lol'))