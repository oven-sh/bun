const form = new FormData();
form.append("first", "1");
console.log(form.get("first").length, form.get("missing") === null, form.getAll("first").length, form.has("first"));
