// `new` and the constructors below bring the `this` of a function that the program constructs with: it is what the function makes, not every layout that fits the written type.
// RUN: link
// CHECK: layout [[made]] kind=Instance name="Message"
// CHECK-LABEL: function {{*}}name="Message"
// CHECK: thisType={type=[[made]] site=
// A helper gets its `this` from whoever calls it: the written type stands.
// CHECK-LABEL: function {{*}}name="reset"
// CHECK: thisType={type=undefined|null|

interface MessageLike {
  text: string;
  sent: boolean;
}

export function Message(this: MessageLike, text: string) {
  this.text = text;
  this.sent = false;
}
Message.prototype.send = function (this: MessageLike) {
  this.sent = true;
};

export function reset(this: MessageLike) {
  this.sent = false;
}
