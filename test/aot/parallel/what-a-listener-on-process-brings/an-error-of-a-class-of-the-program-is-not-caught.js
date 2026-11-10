// STATISTIC: ImageFunctionsEmitted <= 20
class Shortage extends Error {
  constructor(amount) { super("short by " + amount); this.amount = amount; }
  doubled() { return this.amount * 2; }
}
process.on("uncaughtException", (error, origin) => console.log(error instanceof Shortage, error.doubled(), error.message, origin));
throw new Shortage(21);
