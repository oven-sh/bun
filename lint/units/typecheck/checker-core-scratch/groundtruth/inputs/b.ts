interface Foo { b: string; }
declare namespace NS { var w: string; }
declare var Foo: { new(): Foo };
declare module "amb" { export var r: string; }
