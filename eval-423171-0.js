process.argv.splice(1, 1);try {
        Bun.jest(import.meta.path).expect.unreachable("");
      } catch (e) {
        console.log(JSON.stringify({ name: e.name, message: e.message, isError: e instanceof Error }));
      }