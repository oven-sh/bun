class Above { static name = 5; }
class Below extends Above {}
console.log(Below.name, typeof Below.name, Below.name.length, Above.name + 1);
