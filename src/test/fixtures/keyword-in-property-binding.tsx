const FooBar = {};
const ImportNamespace = {
  default: FooBar,
};

const { default: App } = ImportNamespace;

console.log(FooBar || App);
