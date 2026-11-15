// A class below File is a Blob too. What was appended is what get(), getAll() and the iterators hand out.
class Upload extends File {
  say() {
    return "said";
  }
}
const upload = new Upload(["x"], "x.txt");
const form = new FormData();
form.append("f", upload);
console.log(form.getAll("f")[0] === upload);
console.log(form.get("f") === upload);
console.log(form.getAll("f").includes(upload));
console.log(`${form.get("f").say()} ${form.get("f") instanceof Blob} ${upload instanceof Blob}`);
for (const [, value] of form) console.log(value === upload);
