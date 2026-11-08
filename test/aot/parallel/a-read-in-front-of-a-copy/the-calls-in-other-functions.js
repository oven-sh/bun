const seen = [];
function note(event) {
  if (event.kind === "tick") return;
  seen.push({ ...event, order: seen.length + 1 });
}
function login(user) { note({ kind: "login", user }); }
function upload(user, size) { note({ kind: "upload", user, size }); }
function logout() { note({ kind: "logout" }); }
login("ann"); upload("ann", 12); logout();
console.log(seen.length, seen[0].user, seen[1].size, seen[2].kind);
