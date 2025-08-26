declare module "bun" {
  export namespace __experimental {
    /**
     * Base interface for static site generation route parameters.
     *
     * Supports both single string values and arrays of strings for dynamic route segments.
     * This is typically used for route parameters like `[slug]`, `[...rest]`, or `[id]`.
     *
     * @warning These APIs are experimental and might be moved/changed in future releases.
     *
     * @example
     * ```tsx
     * // Simple slug parameter
     * type BlogParams = { slug: string };
     *
     * // Multiple parameters
     * type ProductParams = {
     *   category: string;
     *   id: string;
     * };
     *
     * // Catch-all routes with string arrays
     * type DocsParams = {
     *   path: string[];
     * };
     * ```
     */
    export interface SSGParamsLike {
      [key: string]: string | string[];
    }

    /**
     * Configuration object for a single static route to be generated.
     *
     * Each path object contains the parameters needed to render a specific
     * instance of a dynamic route at build time.
     *
     * @warning These APIs are experimental and might be moved/changed in future releases.
     *
     * @template Params - The shape of route parameters for this path
     *
     * @example
     * ```tsx
     * // Single blog post path
     * const blogPath: SSGPath<{ slug: string }> = {
     *   params: { slug: "my-first-post" }
     * };
     *
     * // Product page with multiple params
     * const productPath: SSGPath<{ category: string; id: string }> = {
     *   params: {
     *     category: "electronics",
     *     id: "laptop-123"
     *   }
     * };
     *
     * // Documentation with catch-all route
     * const docsPath: SSGPath<{ path: string[] }> = {
     *   params: { path: ["getting-started", "installation"] }
     * };
     * ```
     */
    export interface SSGPath<Params extends SSGParamsLike = SSGParamsLike> {
      params: Params;
    }

    /**
     * Array of static paths to be generated at build time.
     *
     * This type represents the collection of all route configurations
     * that should be pre-rendered for a dynamic route.
     *
     * @warning These APIs are experimental and might be moved/changed in future releases.
     *
     * @template Params - The shape of route parameters for these paths
     *
     * @example
     * ```tsx
     * // Array of blog post paths
     * const blogPaths: SSGPaths<{ slug: string }> = [
     *   { params: { slug: "introduction-to-bun" } },
     *   { params: { slug: "performance-benchmarks" } },
     *   { params: { slug: "getting-started-guide" } }
     * ];
     *
     * // Mixed parameter types
     * const productPaths: SSGPaths<{ category: string; id: string }> = [
     *   { params: { category: "books", id: "javascript-guide" } },
     *   { params: { category: "electronics", id: "smartphone-x" } }
     * ];
     * ```
     */
    export type SSGPaths<Params extends SSGParamsLike = SSGParamsLike> = SSGPath<Params>[];

    /**
     * Props interface for SSG page components.
     *
     * This interface defines the shape of props that will be passed to your
     * static page components during the build process. The `params` object
     * contains the route parameters extracted from the URL pattern.
     *
     * @warning These APIs are experimental and might be moved/changed in future releases.
     *
     * @template Params - The shape of route parameters for this page
     *
     * @example
     * ```tsx
     * // Blog post component props
     * interface BlogPageProps extends SSGPageProps<{ slug: string }> {
     *   // params: { slug: string } is automatically included
     * }
     *
     * // Product page component props
     * interface ProductPageProps extends SSGPageProps<{
     *   category: string;
     *   id: string;
     * }> {
     *   // params: { category: string; id: string } is automatically included
     * }
     *
     * // Usage in component
     * function BlogPost({ params }: BlogPageProps) {
     *   const { slug } = params; // TypeScript knows slug is a string
     *   return <h1>Blog post: {slug}</h1>;
     * }
     * ```
     */
    export interface SSGPageProps<Params extends SSGParamsLike = SSGParamsLike> {
      params: Params;
    }

    /**
     * React component type for SSG pages that can be statically generated.
     *
     * This type represents a React component that receives SSG page props
     * and can be rendered at build time. The component can be either a regular
     * React component or an async React Server Component for advanced use cases
     * like data fetching during static generation.
     *
     * @warning These APIs are experimental and might be moved/changed in future releases.
     *
     * @template Params - The shape of route parameters for this page component
     *
     * @example
     * ```tsx
     * // Regular synchronous SSG page component
     * const BlogPost: SSGPage<{ slug: string }> = ({ params }) => {
     *   return (
     *     <article>
     *       <h1>Blog Post: {params.slug}</h1>
     *       <p>This content was generated at build time!</p>
     *     </article>
     *   );
     * };
     *
     * // Async React Server Component for data fetching
     * const AsyncBlogPost: SSGPage<{ slug: string }> = async ({ params }) => {
     *   // Fetch data during static generation
     *   const post = await fetchBlogPost(params.slug);
     *   const author = await fetchAuthor(post.authorId);
     *
     *   return (
     *     <article>
     *       <h1>{post.title}</h1>
     *       <p>By {author.name}</p>
     *       <div dangerouslySetInnerHTML={{ __html: post.content }} />
     *     </article>
     *   );
     * };
     *
     * // Product page with multiple params and async data fetching
     * const ProductPage: SSGPage<{ category: string; id: string }> = async ({ params }) => {
     *   const [product, reviews] = await Promise.all([
     *     fetchProduct(params.category, params.id),
     *     fetchProductReviews(params.id)
     *   ]);
     *
     *   return (
     *     <div>
     *       <h1>{product.name}</h1>
     *       <p>Category: {params.category}</p>
     *       <p>Price: ${product.price}</p>
     *       <div>
     *         <h2>Reviews ({reviews.length})</h2>
     *         {reviews.map(review => (
     *           <div key={review.id}>{review.comment}</div>
     *         ))}
     *       </div>
     *     </div>
     *   );
     * };
     * ```
     */
    export type SSGPage<Params extends SSGParamsLike = SSGParamsLike> = React.ComponentType<SSGPageProps<Params>>;

    /**
     * getStaticPaths is Bun's implementation of SSG (Static Site Generation) path determination.
     *
     * This function is called at your app's build time to determine which
     * dynamic routes should be pre-rendered as static pages. It returns an
     * array of path parameters that will be used to generate static pages for
     * dynamic routes (e.g., [slug].tsx, [category]/[id].tsx).
     *
     * The function can be either synchronous or asynchronous, allowing you to
     * fetch data from APIs, databases, or file systems to determine which paths
     * should be statically generated.
     *
     * @warning These APIs are experimental and might be moved/changed in future releases.
     *
     * @template Params - The shape of route parameters for the dynamic route
     *
     * @returns An object containing an array of paths to be statically generated
     *
     * @example
     * ```tsx
     * // In pages/blog/[slug].tsx ———————————————————╮
     * export const getStaticPaths: GetStaticPaths<{ slug: string }> = async () => {
     *   // Fetch all blog posts from your CMS or API at build time
     *   const posts = await fetchBlogPosts();
     *
     *   return {
     *     paths: posts.map((post) => ({
     *       params: { slug: post.slug }
     *     }))
     *   };
     * };
     *
     * // In pages/products/[category]/[id].tsx
     * export const getStaticPaths: GetStaticPaths<{
     *   category: string;
     *   id: string;
     * }> = async () => {
     *   // Fetch products from database
     *   const products = await db.products.findMany({
     *     select: { id: true, category: { slug: true } }
     *   });
     *
     *   return {
     *     paths: products.map(product => ({
     *       params: {
     *         category: product.category.slug,
     *         id: product.id
     *       }
     *     }))
     *   };
     * };
     *
     * // In pages/docs/[...path].tsx (catch-all route)
     * export const getStaticPaths: GetStaticPaths<{ path: string[] }> = async () => {
     *   // Read documentation structure from file system
     *   const docPaths = await getDocumentationPaths('./content/docs');
     *
     *   return {
     *     paths: docPaths.map(docPath => ({
     *       params: { path: docPath.split('/') }
     *     }))
     *   };
     * };
     *
     * // Synchronous example with static data
     * export const getStaticPaths: GetStaticPaths<{ id: string }> = () => {
     *   const staticIds = ['1', '2', '3', '4', '5'];
     *
     *   return {
     *     paths: staticIds.map(id => ({
     *       params: { id }
     *     }))
     *   };
     * };
     * ```
     */
    export type GetStaticPaths<Params extends SSGParamsLike = SSGParamsLike> = () => MaybePromise<{
      paths: SSGPaths<Params>;
    }>;
  }
}
