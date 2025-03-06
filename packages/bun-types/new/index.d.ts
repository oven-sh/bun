/// <reference path="./s3.d.ts" />

declare var onmessage: never;

declare var Bun: typeof import("bun");

declare module "bun" {
	interface Env {
		[key: string]: string | undefined;
	}

	export var env: Env;

	export var fetch: {
		(request: Request, init?: RequestInit): Promise<Response>;
		(url: string | URL | Request, init?: RequestInit): Promise<Response>;
		(
			input: string | URL | globalThis.Request,
			init?: RequestInit,
		): Promise<Response>;
		preconnect(
			url: string | URL,
			options?: {
				dns?: boolean;
				tcp?: boolean;
				http?: boolean;
				https?: boolean;
			},
		): void;
	};
}

interface RequestInit {
	verbose?: boolean;
	proxy?: string;
	s3?: import("bun").S3Options;
}

declare namespace fetch {
	export function preconnect(
		url: string | URL,
		options?: {
			dns?: boolean;
			tcp?: boolean;
			http?: boolean;
			https?: boolean;
		},
	): void;
}

interface ImportMeta {
	url: string;
	readonly path: string;
	readonly dir: string;
	readonly file: string;
	readonly env: NodeJS.ProcessEnv;
	resolveSync(moduleId: string, parent?: string): string;
	require: NodeJS.Require;
	readonly main: boolean;
	dirname: string;
	filename: string;

	hot?: {
		data: any;
	};
}

interface Headers {
	toJSON(): Record<string, string>;
}

declare namespace NodeJS {
	interface Process {
		readonly version: string;
		browser: boolean;
		isBun: true;
		revision: string;
		reallyExit(code?: number): never;
		dlopen(module: { exports: any }, filename: string, flags?: number): void;
	}

	interface ProcessVersions extends Dict<string> {
		bun: string;
	}
}

declare module "*.svg" {
	const content: `${string}.svg`;
	export = content;
}
