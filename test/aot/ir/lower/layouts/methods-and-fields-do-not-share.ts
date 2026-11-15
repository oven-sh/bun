// RUN: link
// CHECK: layout [[method]] {{*}}fields=[{key="m" declared={type={{*}}} flags=[IsMethod, IsNeverWritten]}]
// CHECK: layout [[field]] {{*}}fields=[{key="m" declared={type={{*}}} flags=[IsNeverWritten]}]
// CHECK: function {{*}}name="both" {{*}}parameters=[{type=undefined|null|[[method]] flags={{*}}}, {type=undefined|null|[[field]] flags={{*}}}]

// A layout's key holds each name and its kind, field or method, so `m(): void` and `m: () => void` are two layouts.
interface WithMethod {
  m(): void;
}

interface WithField {
  m: () => void;
}

export function both(method: WithMethod, field: WithField) {
  return [method, field];
}
