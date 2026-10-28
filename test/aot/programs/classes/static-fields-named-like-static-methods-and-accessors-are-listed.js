// Each class has a static field with the name of a static method, getter or setter of its own. The field comes last, so the name is listed.
class MethodFirst { static m() {} static m = 1; }
class FieldFirst { static m = 1; static m() {} }
class Getter { static get m() { return 2; } static m = 1; }
class Setter { static set m(value) {} static m = 1; }
class Computed { static ["m"]() {} static ["m"] = 1; }
class Below extends FieldFirst { static z = 3; static q() {} static q = 4; }
class Mixed { static a = 1; static b() {} static c = 3; static b = 2; static a() {} }
for (const made of [MethodFirst, FieldFirst, Getter, Setter, Computed, Below, Mixed]) {
  const names = [];
  for (const key in made) names.push(key);
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += made.m ?? made.b;
  console.log(made.name, names.join(), Object.keys(made).join(), JSON.stringify(Object.entries(made)), JSON.stringify({ ...made }), sum);
}
