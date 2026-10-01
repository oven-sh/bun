try { new Bun.Transpiler({loader:"js"}).transformSync("((b)) => 1"); console.log("js accepts ((b)) => 1") } catch (e) { console.log("js rejects:", e.message) }
