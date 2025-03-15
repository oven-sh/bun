<script lang="ts">
  let { title, link, children } = $props();
</script>

<div class="feature-card">
  <h3>
    <a href={link}>
      {title}
    </a>
  </h3>
  <p>
    {@render children()}
  </p>
</div>

<style>
  .feature-card {
    padding: 1rem;
    border-radius: 0.5rem;
    background-color: #fff;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: transform 0.3s ease;
  }

  .feature-card h3 {
    margin-bottom: 0.5rem;
  }
</style>
