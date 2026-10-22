const form = new FormData();
form.append("first", "1");
form.forEach((value, name, whole) => console.log(value.length, name, whole === form));
