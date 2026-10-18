// passes a record of two primitive fields, which came in through a variable without an annotation, to a function that reads both
const operations = 64;
const users: User[] = [];
for (let i = 0; i < operations; i++) users.push(doorForUser(i));
let sum = 0;

kernel: {
  for (let k = 0; k < users.length; k++) {
    const user = users[k];
    sum += label(user);
  }
}

console.log(sum);
