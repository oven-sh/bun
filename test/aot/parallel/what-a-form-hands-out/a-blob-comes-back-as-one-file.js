// The form makes a File of a Blob at the first read and hands out that File at the later ones. The Blob itself stays what it was.
const blob = new Blob(["bytes"], { type: "text/plain" });
blob.mark = 1;
const form = new FormData();
form.set("a", blob);
const first = form.get("a");
first.mark = 2;
const second = form.getAll("a")[0];
console.log(
  `${first === blob} ${first === second} ${second.mark} ${blob.mark} ${first instanceof File} ${first.name} ${first.type} ${await first.text()}`,
);
const named = new FormData();
named.append("a", new File(["x"], "old.txt"), "new.txt");
console.log(named.get("a").name);
