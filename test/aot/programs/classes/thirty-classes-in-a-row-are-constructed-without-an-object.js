// Thirty classes in a row, each below the one before, and each constructor stores one field. A function that makes an object of the last class and only reads
// its fields makes no object: all thirty constructors have gone into the function, and the fields are values of the function.
// IR= 0 sumOfFields  = NewObject 
// IR= 0 sumOfFields  = CallDirect 
// IR= 1 sumOfFields : 44 = Integer 
class Level0 { constructor() { this.field0 = 0; } }
class Level1 extends Level0 { constructor() { super(); this.field1 = 1; } }
class Level2 extends Level1 { constructor() { super(); this.field2 = 2; } }
class Level3 extends Level2 { constructor() { super(); this.field3 = 3; } }
class Level4 extends Level3 { constructor() { super(); this.field4 = 4; } }
class Level5 extends Level4 { constructor() { super(); this.field5 = 5; } }
class Level6 extends Level5 { constructor() { super(); this.field6 = 6; } }
class Level7 extends Level6 { constructor() { super(); this.field7 = 7; } }
class Level8 extends Level7 { constructor() { super(); this.field8 = 8; } }
class Level9 extends Level8 { constructor() { super(); this.field9 = 9; } }
class Level10 extends Level9 { constructor() { super(); this.field10 = 10; } }
class Level11 extends Level10 { constructor() { super(); this.field11 = 11; } }
class Level12 extends Level11 { constructor() { super(); this.field12 = 12; } }
class Level13 extends Level12 { constructor() { super(); this.field13 = 13; } }
class Level14 extends Level13 { constructor() { super(); this.field14 = 14; } }
class Level15 extends Level14 { constructor() { super(); this.field15 = 15; } }
class Level16 extends Level15 { constructor() { super(); this.field16 = 16; } }
class Level17 extends Level16 { constructor() { super(); this.field17 = 17; } }
class Level18 extends Level17 { constructor() { super(); this.field18 = 18; } }
class Level19 extends Level18 { constructor() { super(); this.field19 = 19; } }
class Level20 extends Level19 { constructor() { super(); this.field20 = 20; } }
class Level21 extends Level20 { constructor() { super(); this.field21 = 21; } }
class Level22 extends Level21 { constructor() { super(); this.field22 = 22; } }
class Level23 extends Level22 { constructor() { super(); this.field23 = 23; } }
class Level24 extends Level23 { constructor() { super(); this.field24 = 24; } }
class Level25 extends Level24 { constructor() { super(); this.field25 = 25; } }
class Level26 extends Level25 { constructor() { super(); this.field26 = 26; } }
class Level27 extends Level26 { constructor() { super(); this.field27 = 27; } }
class Level28 extends Level27 { constructor() { super(); this.field28 = 28; } }
class Level29 extends Level28 { constructor() { super(); this.field29 = 29; } }
function sumOfFields(turns) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    const made = new Level29();
    sum += made.field0 + made.field15 + made.field29 + turn;
  }
  return sum;
}
const one = [new Level0(), new Level1(), new Level2(), new Level3(), new Level4(), new Level5(), new Level6(), new Level7(), new Level8(), new Level9(), new Level10(), new Level11(), new Level12(), new Level13(), new Level14(), new Level15(), new Level16(), new Level17(), new Level18(), new Level19(), new Level20(), new Level21(), new Level22(), new Level23(), new Level24(), new Level25(), new Level26(), new Level27(), new Level28(), new Level29()];
console.log(sumOfFields(1000), one.map((made, level) => made["field" + level]).join(" "), Object.keys(one[29]).length);
