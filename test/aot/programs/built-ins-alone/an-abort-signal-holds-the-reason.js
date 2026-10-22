const controller = new AbortController();
console.log(controller.signal.aborted, controller.signal.reason === undefined);
controller.abort({ code: 1.5 });
console.log(controller.signal.aborted, controller.signal.reason.code + 1);
