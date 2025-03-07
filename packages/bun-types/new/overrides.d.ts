export {}; // `declare global` requires the ambient file to be a module

declare global {
	namespace NodeJS {
		interface Process {
			readonly version: string;
			browser: boolean;

			/** Whether you are using Bun */
			isBun: true;
			/** The current git sha of Bun **/
			revision: string;
			reallyExit(code?: number): never;
			dlopen(module: { exports: any }, filename: string, flags?: number): void;
		}
	}
}
