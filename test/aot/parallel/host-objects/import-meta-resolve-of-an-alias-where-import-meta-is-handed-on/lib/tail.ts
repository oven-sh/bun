export const tail = (ask: () => string) => {
  try {
    return ask().split("/").slice(-2).join("/");
  } catch (error: any) {
    return error.constructor.name + ": " + error.message.replace(/ imported from .*/, "");
  }
};
