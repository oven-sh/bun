import { Constant, Text } from "./texts";

console.log(Text.Both, Text.OfMember, Text.InBrackets, Text.Plain);
console.log(Text.Computed, Text.Negative, Text.Joined);
console.log(Constant.B, Constant.C, JSON.stringify([Constant.A, Constant.B, Text.One, Text.Both]));

enum Local {
  Two = 2,
  Text = `two is ${Two}`,
  Longer = `${Local.Text}, twice ${Two * 2}`,
}
console.log(Local.Text, Local.Longer, Local[2]);
