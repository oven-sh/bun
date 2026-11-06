function f(code) {
  switch (code) {
    case 1:
      let count = 10;
      function bump() {
        return ++count;
      }
      bump();
      return [bump(), count];
    case 2:
      try {
        return bump();
      } catch (error) {
        return error.name;
      }
  }
}
console.log(JSON.stringify(f(1)), JSON.stringify(f(1)), f(2));
