<script lang="ts">
  import { page } from "$app/state";
</script>
<p>our own page for errors: {page.status} {page.error?.message}</p>
