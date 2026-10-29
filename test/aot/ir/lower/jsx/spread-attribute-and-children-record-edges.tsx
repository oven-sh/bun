// RUN(SPREAD): link
// SPREAD: layout [[target]] name="SpreadTarget"
// SPREAD: layout {{*}}name="SpreadSource"{{*}}supertypes=[{{*}}[[target]]]

// RUN(CHILD): link
// CHILD: layout {{*}}name="ChildSource"{{*}}supertypes=[{{*}}[[target]]]
// CHILD: layout [[target]] name="ChildTarget"

// RUN(HOLDER): link
// HOLDER: layout {{*}}fields=[{key="item" declared={type=undefined|null|[[source]]|[[overridden]] flags=[OmitsNull, OmitsUndefined]} flags=[IsRequired]}]
// HOLDER-NOT: supertypes=
// HOLDER: layout
// HOLDER: layout [[source]] name="SpreadSource"
// HOLDER: layout [[overridden]] name="Overridden"

// RUN(OVERRIDDEN): link
// OVERRIDDEN-NOT: layout {{*}}name="Overridden"{{*}}supertypes=

// A spread attribute copies the members of an object into the props, so each member goes below the type of the prop with its name. The object that is spread is not the props: its layout goes nowhere. A member that a later attribute replaces need not fit the prop, and one that doesn't fit goes nowhere either. No expression is the list of several children, so each child flows for itself into what `children` holds.

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
