const controller = new AbortController();
controller.abort(new Error("why"));
console.log(controller.signal.aborted, controller.signal.reason.message, controller instanceof AbortController);
console.log(Object.getOwnPropertyNames(AbortController).sort().join(), AbortController.AbortSignal, AbortController.default);
