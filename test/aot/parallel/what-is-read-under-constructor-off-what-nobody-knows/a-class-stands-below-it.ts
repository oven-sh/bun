function below(given: any): any {
  return class Below extends given.constructor {
    count(): number {
      return this.length;
    }
  };
}
const Made = below(JSON.parse("[]"));
const made = new Made();
made.push(1, 2, 3);
console.log(String(made.count()), String(Array.isArray(made)));
