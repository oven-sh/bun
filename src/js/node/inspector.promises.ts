// Hardcoded module "node:inspector/promises"
const inspector = require("node:inspector");

const { Session: BaseSession, console, open, close, url, waitForDebugger } = inspector;

// Promise-based Session that wraps the callback-based Session
class Session extends BaseSession {
  post(method: string, params?: object): Promise<any> {
    return new Promise((resolve, reject) => {
      super.post(method, params, (err: Error | null, result: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }
}

export default {
  console,
  open,
  close,
  url,
  waitForDebugger,
  Session,
};
