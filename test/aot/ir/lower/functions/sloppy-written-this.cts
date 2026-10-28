// `ToThis` makes an object of a primitive, so the header says nothing about the entry value and nothing converts it.
// Only the value that the body uses is converted.

// RUN(UNUSED): link
// UNUSED: module [[entry]] path="{{*}}sloppy-written-this"
// UNUSED: function [[unused]] name="unused" module=[[entry]] {{*}}flags=[IsSloppy, HasThis, {{*}}thisType={type=anything}
// UNUSED: b0([[this]]: anything):
// UNUSED-NOT: ToThis
// UNUSED-NOT: Convert
// UNUSED: Return

// RUN(USED): link
// USED: module [[entry]] path="{{*}}sloppy-written-this"
// USED: function [[used]] name="used" module=[[entry]] {{*}}flags=[IsSloppy, HasThis, {{*}}thisType={type=anything}
// USED: b0([[this]]: anything):
// USED-NOT: Convert [[this]]
// USED: [[object]] = ToThis [[this]]
// USED-NEXT: [[result]] = Convert [[object]] declared={type=number
// USED-NEXT: Return [[result]]

function unused(this: string) {}

function used(this: number) {
  return this;
}

export = { unused, used };
