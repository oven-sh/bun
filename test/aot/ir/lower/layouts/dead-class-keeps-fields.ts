// RUN: link
// CHECK: layout [[d]] kind=Instance name="D" {{*}}fields=[{key="x"
// CHECK: function {{*}}name="read" {{*}}parameters=[{type=undefined|null|[[d]] flags=[IsExpected, OmitsNull, OmitsUndefined]}]

// RUN(CONSTRUCTOR): link
// CONSTRUCTOR-NOT: layout {{*}}name="D"{{*}}constructor=

// RUN(DEFINITION): lower
// DEFINITION-NOT: NewClass

export const C = false ? class D { x = 1 } : undefined;

export function read(instance: InstanceType<NonNullable<typeof C>>) {
  return instance.x;
}
