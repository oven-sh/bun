// @ts-nocheck
import { Foo } from "bacon";
import React from "react";
import * as Boom from "react";
import { createElement } from "react";
export const hello: Foo = React.createElement("div");

export const bacon: (foo: (what: Foo) => (the: Foo) => Foo) => Foo = (
  foo: Foo,
) => {
  return createElement(true);
};

export function funcBacon(foo: (what: Foo) => (the: Foo) => void) {
  this.Foo = foo;
  Boom();
}

export abstract class Bar implements Foo {
  bacon: Foo;
  what: Foo;
}

export class Broke implements Foo {
  bacon: Foo;
  what: Foo;
}
export interface Baz extends Foo {
  foo: Foo;
  bar: Foo;
  boop: Foo;
  Foo: Foo;
}
export interface Baz extends Foo {}
