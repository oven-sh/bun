import adapter from '@bun-community/sveltekit-adapter-bun';
import preprocess from 'svelte-preprocess';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://github.com/sveltejs/svelte-preprocess
	// for more information about preprocessors
	preprocess: preprocess(),

	kit: {
		adapter: adapter({
							 dynamic_origin: true
						 })
	}
};

export default config;
