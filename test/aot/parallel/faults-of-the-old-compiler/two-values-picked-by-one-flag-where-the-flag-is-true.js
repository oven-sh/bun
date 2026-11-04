// The urgent queue's head if urgent work is allowed and there is one, else the normal queue's.
class Job { constructor(name) { this.name = name; } }
class Queue { constructor(head, length) { this.head = head; this.length = length; } }
async function next(urgent, normal, allowUrgent, forced) {
  await null;
  if (normal.length <= 0 || urgent.length <= 0 || normal.head === null) return "idle";
  const useUrgent = (allowUrgent || forced) && urgent.head !== null;
  const queue = useUrgent ? urgent : normal;
  const length = useUrgent ? urgent.length : normal.length;
  if (length > 0 && queue.head !== null) return queue.head.name;
  return "idle";
}
const hasUrgent = (process.argv[2] ?? "yes") === "yes", allow = (process.argv[3] ?? "yes") === "yes", force = (process.argv[4] ?? "no") === "yes";
const urgent = new Queue(hasUrgent ? new Job("page") : null, 1), normal = new Queue(new Job("mail"), 1);
console.log(await next(urgent, normal, allow, force));
