declare module "*.txt" {
	var text: string;
	export = text;
}

declare module "*.toml" {
	var contents: any;
	export = contents;
}

declare module "*.jsonc" {
	var contents: any;
	export = contents;
}

declare module "*/bun.lock" {
	var contents: import("bun").BunLockFile;
	export = contents;
}

declare module "*.html" {
	// In Bun v1.2, we might change this to Bun.HTMLBundle
	var contents: any;
	export = contents;
}

declare module "*.svg" {
	// Bun 1.2.3 added support for frontend dev server
	var contents: `${string}.svg`;
	export = contents;
}
