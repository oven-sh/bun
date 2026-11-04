// A variable that a callback changes is a value in the loop that walks the list, which stands in a loop of its own. In some turns the list changes in the middle of the walk:
// it gets shorter, it gets a hole, it takes a text. The walk goes on in other code, which needs the variables as the callback's environment holds them, with what they had come to.
const said: string[] = [];
const turns = 30000;

function fresh(): number[] {
  return Array.from({ length: 32 }, (_, k) => k * 3);
}

function shorter(): number {
  const list = fresh();
  let total = 0;
  for (let i = 0; i < turns; i++) {
    let sum = i & 1;
    let seen = 0;
    list.forEach(value => {
      sum += value;
      seen++;
      if (seen === 9 && i % 9973 === 5) list.length = 20;
    });
    if (list.length !== 32) for (let k = list.length; k < 32; k++) list.push(k * 3);
    total = (total + sum * 31 + seen) | 0;
  }
  return total;
}

function withAHole(): number {
  const list = fresh();
  let total = 0;
  for (let i = 0; i < turns; i++) {
    let sum = i & 1;
    let seen = 0;
    list.forEach((value, k) => {
      sum += value;
      seen++;
      if (k === 4 && i % 9973 === 7) delete list[17];
    });
    list[17] = 51;
    total = (total + sum * 31 + seen) | 0;
  }
  return total;
}

function takesAText(): string {
  const list: (number | string)[] = fresh();
  let total = 0;
  let texts = "";
  for (let i = 0; i < turns; i++) {
    let sum = i & 1;
    let text = "";
    list.forEach((value, k) => {
      if (typeof value === "number") sum += value;
      else text += value + sum;
      if (k === 6 && i % 9973 === 11) list[20] = "t";
    });
    if (i % 9973 === 12) list[20] = 60;
    total = (total + sum) | 0;
    texts += text;
  }
  return total + texts;
}

function anObject(): number {
  const list = fresh();
  let total = 0;
  for (let i = 0; i < turns; i++) {
    const tally = { sum: i & 1, seen: 0 };
    list.forEach(value => {
      tally.sum += value;
      tally.seen++;
      if (tally.seen === 13 && i % 9973 === 3) list.length = 14;
    });
    if (list.length !== 32) for (let k = list.length; k < 32; k++) list.push(k * 3);
    total = (total + tally.sum * 31 + tally.seen) | 0;
  }
  return total;
}

function oneWalkInAnother(): number {
  const rows = [fresh(), fresh(), fresh()];
  let total = 0;
  for (let i = 0; i < turns / 3; i++) {
    let sum = 0;
    rows.forEach((row, at) => {
      let part = at;
      row.forEach((value, k) => {
        part += value;
        sum++;
        if (k === 3 && at === 1 && i % 997 === 5) row.length = 8;
      });
      if (row.length !== 32) for (let k = row.length; k < 32; k++) row.push(k * 3);
      sum += part;
    });
    total = (total + sum) | 0;
  }
  return total;
}

function reduced(): number {
  const list = fresh();
  let total = 0;
  for (let i = 0; i < turns; i++) {
    let calls = 0;
    const sum = list.reduce((so, value) => {
      calls++;
      if (calls === 5 && i % 9973 === 9) list.length = 6;
      return so + value;
    }, i & 1);
    if (list.length !== 32) for (let k = list.length; k < 32; k++) list.push(k * 3);
    total = (total + sum * 7 + calls) | 0;
  }
  return total;
}

said.push("shorter " + shorter());
said.push("with a hole " + withAHole());
said.push("takes a text " + takesAText());
said.push("an object " + anObject());
said.push("one walk in another " + oneWalkInAnother());
said.push("reduced " + reduced());
console.log(said.join("\n"));
