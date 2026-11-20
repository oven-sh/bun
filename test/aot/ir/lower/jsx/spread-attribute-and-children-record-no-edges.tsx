// RUN: link
// CHECK: layout {{*}}fields=[{key="item" declared={type=undefined|null|[[overridden]]|[[spreadSource]] flags=[OmitsNull, OmitsUndefined]} flags=[IsRequired]}]
// CHECK-NOT: supertypes=
// CHECK: layout [[overridden]] {{*}}fields=[{key="size" {{*}}}]
// CHECK-NOT: supertypes=
// CHECK: layout {{*}}fields=[{key="child" {{*}}, {key="childName" {{*}}}]
// CHECK-NOT: supertypes=
// CHECK: layout [[spreadSource]] {{*}}fields=[{key="spread" {{*}}, {key="spreadName" {{*}}}]
// CHECK-NOT: supertypes=
// CHECK: layout

// A family holds what is declared, and nothing here extends anything. A spread attribute copies the members of an object into the props, and each child flows into what `children` holds: neither puts a layout below the type of the prop. So no layout of this file has a supertype: not `ChildSource`, not the object that is spread, not `SpreadSource`, not `Overridden`, and none of those that are printed between them.

interface SpreadTarget {
  spreadName: string;
}

interface SpreadSource {
  spreadName: string;
  spread: number;
}

interface ChildTarget {
  childName: string;
}

interface ChildSource {
  childName: string;
  child: number;
}

interface Overridden {
  size: number;
}

function Spread(p: { item: SpreadTarget; other: number }) {
  return null;
}

function Children(p: { children?: ChildTarget[] }) {
  return null;
}

export function spread(holder: { item: SpreadSource }) {
  return <Spread other={1} {...holder} />;
}

export function overridden(holder: { item: Overridden }, target: SpreadTarget) {
  return <Spread other={1} {...holder} item={target} />;
}

export function children(source: ChildSource, target: ChildTarget) {
  return (
    <Children>
      {target}
      {source}
    </Children>
  );
}

export const made = [
  spread({ item: { spreadName: "a", spread: 1 } }),
  overridden({ item: { size: 1 } }, { spreadName: "b" }),
  children({ childName: "c", child: 2 }, { childName: "d" }),
];
