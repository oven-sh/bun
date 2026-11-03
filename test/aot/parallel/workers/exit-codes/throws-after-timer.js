await new Promise(resolve => setTimeout(resolve, 5));
throw new Error("after timer");
