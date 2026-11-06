// getStore() reads the object that holds the current frame off a private global of the host, and asks a helper that leaves early whether the storage is masked.
// In a loop the object comes out of a cell of the executable and the helper's early way out is part of the loop: no name is looked up and nothing is called.
// COUNT: arrivals <= 3
// COUNT: branches <= 661000
// COUNT: operations <= 99
import { AsyncLocalStorage } from "node:async_hooks";
const sessions = new AsyncLocalStorage();
const others = [new AsyncLocalStorage(), new AsyncLocalStorage()];
function sum(turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) total += sessions.getStore().id + others[1].getStore();
  return total;
}
sessions.run({ id: 1 }, () => others[0].run(1, () => others[1].run(2, () => console.log(sum(20000)))));
