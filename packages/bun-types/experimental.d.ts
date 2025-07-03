declare module "bun" {
  export namespace experimental {
    export interface SSGParamsLike {
      [key: string]: string | string[];
    }

    /**
     * getStaticProps is Bun's implementation of SSG (Static site generation)
     *
     * This function is called at your app's build time to determine which
     * dynamic routes should be pre-rendered as static pages. It returns an
     * array of path parameters that will be used to generate static pages for
     * dynamic routes (e.g., [slug].tsx).
     *
     * @returns An object containing an array of paths to be statically
     * generated
     *
     * @example
     * ```tsx
     * // In pages/blog/[slug].tsx ————————————————————————╮
     * export const getStaticPaths: Bun.GetStaticPaths<{ slug: string }> = async () => {
     *   // Fetch all blog posts at build time
     *   const posts = await fetchBlogPosts();
     *
     *   return {
     *     paths: posts.map(post => ({
     *       params: { slug: post.slug }
     *     }))
     *   };
     * };
     * ```
     */
    export type GetStaticPaths<Params extends SSGParamsLike = SSGParamsLike> = () => MaybePromise<{
      paths: SSGPaths<Params>;
    }>;

    export interface SSGPath<Params extends SSGParamsLike = SSGParamsLike> {
      params: Params;
    }

    export type SSGPaths<Params extends SSGParamsLike = SSGParamsLike> = SSGPath<Params>[];

    export interface SSGPageProps<Params extends SSGParamsLike = SSGParamsLike> {
      params: Params;
    }

    export type SSGPage<Params extends SSGParamsLike = SSGParamsLike> = React.ComponentType<SSGPageProps<Params>>;
  }
}
