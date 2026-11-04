class Five { valueOf() { return 5; } toString() { return "five"; } }
console.log(new Five() + 1, `${new Five()}`, [new Five()].join(), new Five() > 4);
