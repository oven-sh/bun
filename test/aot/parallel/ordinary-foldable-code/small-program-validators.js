const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAMPLES = ["a@b.co", "not an email", "x@y", "Jane.Doe@Example.ORG"];
console.log(SAMPLES.map((s) => EMAIL.test(s)));
console.log(["hello-world", "Hello", "a--b", "a1-b2"].filter((s) => SLUG.test(s)));
